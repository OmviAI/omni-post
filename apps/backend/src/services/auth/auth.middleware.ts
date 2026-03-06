import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { User } from '@prisma/client';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { getCookieUrlFromDomain } from '@gitroom/helpers/subdomain/subdomain.management';
import { HttpForbiddenException } from '@gitroom/nestjs-libraries/services/exception.filter';
import { MastraService } from '@gitroom/nestjs-libraries/chat/mastra.service';
import { createClerkClient, verifyToken } from '@clerk/backend';

export const removeAuth = (res: Response) => {
  res.cookie('auth', '', {
    domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
    ...(!process.env.NOT_SECURED
      ? {
          secure: true,
          httpOnly: true,
          sameSite: 'none',
        }
      : {}),
    expires: new Date(0),
    maxAge: -1,
  });
  res.header('logout', 'true');
};

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(
    private _organizationService: OrganizationService,
    private _userService: UsersService
  ) {}
  async use(req: Request, res: Response, next: NextFunction) {
    // Log for debugging copilot endpoints
    if (req.path.includes('/copilot/')) {
      console.log(`[AuthMiddleware] Copilot request - Path: ${req.path}, HasAuthHeader: ${!!req.headers.auth}, HasAuthCookie: ${!!req.cookies.auth}, AllHeaders: ${JSON.stringify(Object.keys(req.headers))}, AllCookies: ${JSON.stringify(Object.keys(req.cookies || {}))}`);
    }
    
    // 1) Prefer Authorization: Bearer <clerk-jwt> when present
    const authHeader =
      (req.headers.authorization || req.headers.Authorization) as
        | string
        | undefined;

    try {
      let user: User | null = null;

      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice('Bearer '.length);
        const secretKey = process.env.CLERK_SECRET_KEY;
        if (!secretKey) {
          throw new HttpForbiddenException();
        }

        const audience = process.env.CLERK_JWT_AUDIENCE;
        const claims = await verifyToken(
          token,
          audience ? { secretKey, audience } : { secretKey },
        );

        // Log available claim keys for debugging (but not values for security)
        const claimKeys = Object.keys(claims || {});
        console.log(
          `[AuthMiddleware] Clerk token claims keys: ${claimKeys.join(', ')}`,
        );

        // Clerk session JWTs often do NOT include email; they include `sub` (userId).
        // Prefer validating by `sub` first, then fall back to fetching the user from Clerk to obtain email.
        const clerkUserId = (claims as any)?.sub as string | undefined;

        // Try multiple possible email claim fields (may be absent)
        const email =
          // @ts-ignore
          claims.email ||
          // @ts-ignore
          claims.email_address ||
          // @ts-ignore
          claims.primary_email ||
          // @ts-ignore
          claims['https://clerk.dev/email'] ||
          // @ts-ignore
          (claims.email_addresses && Array.isArray(claims.email_addresses) && claims.email_addresses[0]?.email_address) ||
          // @ts-ignore
          (claims.email_addresses && Array.isArray(claims.email_addresses) && claims.email_addresses[0]?.email);

        // 1) If we have Clerk userId, try to resolve internal user by id first.
        // This supports setups where internal `User.id` is set to Clerk `user_xxx`.
        if (clerkUserId) {
          user = await this._userService.getUserById(clerkUserId);
          if (user) {
            console.log(
              `[AuthMiddleware] Authenticated via Clerk sub -> internal user id match: ${user.id}`,
            );
          }
        }

        // 2) If not found by id, and we have an email claim, try by email.
        if (!user && email) {
          console.log(`[AuthMiddleware] Found email in claims: ${email}`);
          user = await this._userService.getUserByEmailAnyProvider(email);
          if (user) {
            console.log(
              `[AuthMiddleware] Authenticated via email -> internal user: ${user.id} (${user.email})`,
            );
          }
        }

        // 3) If still not found, fetch Clerk user to obtain primary email, then resolve internal user by email.
        if (!user && clerkUserId) {
          try {
            const clerk = createClerkClient({ secretKey });
            const clerkUser = await clerk.users.getUser(clerkUserId);
            const primaryEmailId = clerkUser.primaryEmailAddressId;
            const primaryEmail =
              clerkUser.emailAddresses?.find((e) => e.id === primaryEmailId)
                ?.emailAddress ||
              clerkUser.emailAddresses?.[0]?.emailAddress ||
              null;

            if (primaryEmail) {
              console.log(
                `[AuthMiddleware] Resolved email from Clerk API for ${clerkUserId}: ${primaryEmail}`,
              );
              user = await this._userService.getUserByEmailAnyProvider(
                primaryEmail,
              );
              if (user) {
                console.log(
                  `[AuthMiddleware] Authenticated via Clerk API email -> internal user: ${user.id} (${user.email})`,
                );
              }
            } else {
              console.error(
                `[AuthMiddleware] Clerk API returned no email addresses for user ${clerkUserId}`,
              );
            }
          } catch (e) {
            console.error(
              `[AuthMiddleware] Failed to fetch Clerk user ${clerkUserId} from Clerk API`,
              e instanceof Error ? e.message : String(e),
            );
          }
        }

        if (!user) {
          console.error(
            `[AuthMiddleware] Unable to resolve internal user for Clerk token. sub=${clerkUserId || 'n/a'}`,
          );
          console.error(
            '[AuthMiddleware] No usable identity found in token claims. Available keys:',
            claimKeys,
          );
          throw new HttpForbiddenException();
        }
      } else {
        // 2) Fallback to legacy JWT stored in header/cookie "auth"
        const auth = (req.headers.auth || req.cookies.auth) as string | undefined;

        if (!auth) {
          // For copilot endpoints, provide more detailed error info
          if (req.path.includes('/copilot/')) {
            console.error(
              `[AuthMiddleware] No auth found for ${req.path} - This endpoint requires authentication`,
            );
          }
          throw new HttpForbiddenException();
        }

        user = AuthService.verifyJWT(auth) as User | null;
      }

      const orgHeader = req.cookies.showorg || req.headers.showorg;

      if (!user) {
        throw new HttpForbiddenException();
      }

      if (!user.activated) {
        throw new HttpForbiddenException();
      }

      const impersonate = req.cookies.impersonate || req.headers.impersonate;
      if (user?.isSuperAdmin && impersonate) {
        const loadImpersonate = await this._organizationService.getUserOrg(
          impersonate
        );

        if (loadImpersonate) {
          user = loadImpersonate.user;
          user.isSuperAdmin = true;
          delete user.password;

          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-expect-error
          req.user = user;

          // @ts-ignore
          loadImpersonate.organization.users =
            loadImpersonate.organization.users.filter(
              (f) => f.userId === user.id
            );
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-expect-error
          req.org = loadImpersonate.organization;
          next();
          return;
        }
      }

      delete user.password;
      // Legacy behavior (kept for reference):
      // const organization = (
      //   await this._organizationService.getOrgsByUserId(user.id)
      // ).filter((f) => !f.users[0].disabled);
      // const setOrg =
      //   organization.find((org) => org.id === orgHeader) || organization[0];

      // Clerk flow: a user may authenticate successfully but have no org membership yet.
      // In that case, auto-create a default org and link them as SUPERADMIN.
      let organizations = await this._organizationService.getOrgsByUserId(user.id);
      organizations = (organizations || []).filter((f) => !f.users?.[0]?.disabled);

      if (!organizations.length) {
        console.warn(
          `[AuthMiddleware] No organizations found for user ${user.id}. Creating default org...`,
        );
        const defaultOrgName =
          // @ts-ignore
          (user.name && `${user.name}'s Workspace`) ||
          (user.email && `${user.email}'s Workspace`) ||
          'Workspace';

        const created = await this._organizationService.createDefaultOrgForUser(
          user.id,
          defaultOrgName,
        );
        organizations = [created];
      }

      const setOrg =
        (orgHeader
          ? organizations.find((org) => org.id === orgHeader)
          : undefined) || organizations[0];

      if (!setOrg) {
        throw new HttpForbiddenException();
      }

      if (!setOrg.apiKey) {
        await this._organizationService.updateApiKey(setOrg.id);
      }

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      req.user = user;

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      req.org = setOrg;
    } catch (err) {
      // Log the error for debugging, but don't expose sensitive info
      if (err instanceof HttpForbiddenException) {
        throw err;
      }
      console.error('[AuthMiddleware] Authentication error:', err instanceof Error ? err.message : String(err));
      throw new HttpForbiddenException();
    }
    next();
  }
}

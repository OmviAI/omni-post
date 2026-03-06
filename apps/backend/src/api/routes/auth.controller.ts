import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Response, Request } from 'express';

import { CreateOrgUserDto } from '@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto';
import { LoginUserDto } from '@gitroom/nestjs-libraries/dtos/auth/login.user.dto';
import { AuthService } from '@gitroom/backend/services/auth/auth.service';
import { ForgotReturnPasswordDto } from '@gitroom/nestjs-libraries/dtos/auth/forgot-return.password.dto';
import { ForgotPasswordDto } from '@gitroom/nestjs-libraries/dtos/auth/forgot.password.dto';
import { ApiTags } from '@nestjs/swagger';
import { getCookieUrlFromDomain } from '@gitroom/helpers/subdomain/subdomain.management';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
import { RealIP } from 'nestjs-real-ip';
import { UserAgent } from '@gitroom/nestjs-libraries/user/user.agent';
import { Provider } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';

@ApiTags('Auth')
@Controller('/auth')
export class AuthController {
  constructor(
    private _authService: AuthService,
    private _emailService: EmailService,
    private _organizationService: OrganizationService
  ) { }

  @Get('/can-register')
  async canRegister() {
    return {
      register: await this._authService.canRegister(Provider.LOCAL as string),
    };
  }

  @Post('/register')
  async register(
    @Req() req: Request,
    @Body() body: CreateOrgUserDto,
    @Res({ passthrough: false }) response: Response,
    @RealIP() ip: string,
    @UserAgent() userAgent: string
  ) {
    try {
      const getOrgFromCookie = this._authService.getOrgFromCookie(
        req?.cookies?.org
      );

      const { jwt, addedOrg } = await this._authService.routeAuth(
        body.provider,
        body,
        ip,
        userAgent,
        getOrgFromCookie
      );

      const activationRequired =
        body.provider === 'LOCAL' && this._emailService.hasProvider();

      if (activationRequired) {
        response.header('activate', 'true');
        response.status(200).json({
          activate: true,
          redirect: '/auth/activate'
        });
        return;
      }

      response.cookie('auth', jwt, {
        domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
        path: '/',
        ...(!process.env.NOT_SECURED
          ? {
            secure: true,
            httpOnly: true,
            sameSite: 'none',
          }
          : {}),
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
      });

      // Always send auth header so frontend can set cookie client-side
      // This is necessary for cross-origin cookie setting on Railway
      response.header('auth', jwt);

      if (typeof addedOrg !== 'boolean' && addedOrg?.organizationId) {
        response.cookie('showorg', addedOrg.organizationId, {
          domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
          path: '/',
          ...(!process.env.NOT_SECURED
            ? {
              secure: true,
              httpOnly: true,
              sameSite: 'none',
            }
            : {}),
          expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
        });

        // Always send showorg header so frontend can set cookie client-side
        response.header('showorg', addedOrg.organizationId);
      }

      Sentry.metrics.count("new_user", 1);
      response.header('onboarding', 'true');
      response.status(200).json({
        register: true,
        redirect: '/' // Add redirect instruction
      });
    } catch (e: any) {
      response.status(400).send(e.message);
    }
  }

  @Post('/login')
  async login(
    @Req() req: Request,
    @Body() body: LoginUserDto,
    @Res({ passthrough: false }) response: Response,
    @RealIP() ip: string,
    @UserAgent() userAgent: string
  ) {
    try {
      const getOrgFromCookie = this._authService.getOrgFromCookie(
        req?.cookies?.org
      );

      const { jwt, addedOrg } = await this._authService.routeAuth(
        body.provider,
        body,
        ip,
        userAgent,
        getOrgFromCookie
      );

      response.cookie('auth', jwt, {
        domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
        ...(!process.env.NOT_SECURED
          ? {
            secure: true,
            httpOnly: true,
            sameSite: 'none',
          }
          : {}),
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
      });

      if (process.env.NOT_SECURED) {
        response.header('auth', jwt);
      }

      if (typeof addedOrg !== 'boolean' && addedOrg?.organizationId) {
        response.cookie('showorg', addedOrg.organizationId, {
          domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
          ...(!process.env.NOT_SECURED
            ? {
              secure: true,
              httpOnly: true,
              sameSite: 'none',
            }
            : {}),
          expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
        });

        if (process.env.NOT_SECURED) {
          response.header('showorg', addedOrg.organizationId);
        }
      }

      response.header('reload', 'true');
      response.status(200).json({
        login: true,
      });
    } catch (e: any) {
      response.status(400).send(e.message);
    }
  }

  @Post('/forgot')
  async forgot(@Body() body: ForgotPasswordDto) {
    try {
      await this._authService.forgot(body.email);
      return {
        forgot: true,
      };
    } catch (e) {
      return {
        forgot: false,
      };
    }
  }

  @Post('/forgot-return')
  async forgotReturn(@Body() body: ForgotReturnPasswordDto) {
    const reset = await this._authService.forgotReturn(body);
    return {
      reset: !!reset,
    };
  }

  @Get('/oauth/:provider')
  async oauthLink(@Param('provider') provider: string, @Query() query: any) {
    return this._authService.oauthLink(provider, query);
  }

  @Post('/activate')
  async activate(
    @Body('code') code: string,
    @Res({ passthrough: false }) response: Response
  ) {
    const activate = await this._authService.activate(code);
    if (!activate) {
      return response.status(200).json({ can: false });
    }

    response.cookie('auth', activate, {
      domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
      ...(!process.env.NOT_SECURED
        ? {
          secure: true,
          httpOnly: true,
          sameSite: 'none',
        }
        : {}),
      expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
    });

    if (process.env.NOT_SECURED) {
      response.header('auth', activate);
    }

    response.header('onboarding', 'true');

    return response.status(200).json({ can: true });
  }

  @Post('/oauth/:provider/exists')
  async oauthExists(
    @Body('code') code: string,
    @Param('provider') provider: string,
    @Res({ passthrough: false }) response: Response
  ) {
    const { jwt, token } = await this._authService.checkExists(provider, code);

    if (token) {
      return response.json({ token });
    }

    response.cookie('auth', jwt, {
      domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
      ...(!process.env.NOT_SECURED
        ? {
            secure: true,
            httpOnly: true,
            sameSite: 'none',
          }
        : {}),
      expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
    });

    if (process.env.NOT_SECURED) {
      response.header('auth', jwt);
    }

    response.header('reload', 'true');

    response.status(200).json({
      login: true,
    });
  }

  /**
   * Exchange a Clerk token for our own JWT session.
   * This is called once when the user first arrives with a Clerk token in the URL.
   * After this, the app uses our own JWT cookie for authentication.
   */
  @Post('/clerk-session')
  async createClerkSession(
    @Body('token') clerkToken: string,
    @Req() req: Request,
    @Res({ passthrough: false }) response: Response,
    @RealIP() ip: string,
    @UserAgent() userAgent: string
  ) {
    try {
      if (!clerkToken) {
        return response.status(400).json({ error: 'Missing Clerk token' });
      }

      const { jwt, user } = await this._authService.createSessionFromClerkToken(
        clerkToken,
      );

      // Get user's organizations
      const organizations = await this._organizationService.getOrgsByUserId(
        user.id,
      );

      // If user has no org, create a default one
      let setOrg = organizations.find(
        (org) => org.id === req.cookies.showorg || req.headers.showorg,
      ) || organizations[0];

      if (!setOrg && organizations.length === 0) {
        // Create default org for user
        const defaultOrg = await this._organizationService.createDefaultOrgForUser(
          user.id,
          user.name || user.email || 'My Organization',
        );
        setOrg = defaultOrg;
      }

      if (!setOrg) {
        return response.status(400).json({ error: 'No organization found' });
      }

      // Ensure org has an API key
      if (!setOrg.apiKey) {
        await this._organizationService.updateApiKey(setOrg.id);
      }

      // Set JWT cookie (same as login flow)
      // For localhost, don't set domain (undefined works better)
      const frontendUrl = process.env.FRONTEND_URL || '';
      const cookieDomain = frontendUrl.includes('localhost') 
        ? undefined 
        : getCookieUrlFromDomain(frontendUrl);
      
      const cookieOptions: any = {
        path: '/',
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
      };
      
      if (cookieDomain) {
        cookieOptions.domain = cookieDomain;
      }
      
      if (!process.env.NOT_SECURED) {
        cookieOptions.secure = true;
        cookieOptions.httpOnly = true;
        cookieOptions.sameSite = 'none';
      }
      
      response.cookie('auth', jwt, cookieOptions);

      // Always send auth header so frontend can set cookie client-side if needed
      response.header('auth', jwt);

      // Set organization cookie
      if (setOrg.id) {
        const orgCookieOptions: any = {
          path: '/',
          expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
        };
        
        if (cookieDomain) {
          orgCookieOptions.domain = cookieDomain;
        }
        
        if (!process.env.NOT_SECURED) {
          orgCookieOptions.secure = true;
          orgCookieOptions.httpOnly = true;
          orgCookieOptions.sameSite = 'none';
        }
        
        response.cookie('showorg', setOrg.id, orgCookieOptions);
        response.header('showorg', setOrg.id);
      }

      response.header('reload', 'true');
      response.status(200).json({
        success: true,
        login: true,
      });
    } catch (e: any) {
      console.error('[AuthController] Error creating Clerk session:', e);
      
      // Provide specific error messages for common cases
      let statusCode = 401;
      let errorMessage = e.message || 'Invalid Clerk token';
      
      if (errorMessage.includes('expired')) {
        statusCode = 401;
        errorMessage = 'Clerk token has expired. Please sign in again.';
      } else if (errorMessage.includes('not found')) {
        statusCode = 404;
        errorMessage = 'User not found. Please ensure your account exists.';
      } else if (errorMessage.includes('not activated')) {
        statusCode = 403;
        errorMessage = 'User account is not activated.';
      }
      
      response.status(statusCode).json({ 
        error: errorMessage,
        expired: errorMessage.includes('expired'),
      });
    }
  }
}

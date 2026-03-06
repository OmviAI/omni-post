import { NextResponse } from 'next/server';
import { verifyToken } from '@clerk/backend';

export async function POST(request: Request) {
  try {
    const { token } = await request.json();

    if (!token) {
      return NextResponse.json(
        { ok: false, error: 'Missing token' },
        { status: 400 },
      );
    }

    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) {
      return NextResponse.json(
        { ok: false, error: 'CLERK_SECRET_KEY not configured on server' },
        { status: 500 },
      );
    }

    // Optional audience check – needed when your Clerk-issued tokens include `azp` / `aud`
    // Configure CLERK_JWT_AUDIENCE in your .env to match the token's audience/azp
    const audience = process.env.CLERK_JWT_AUDIENCE;

    const verifyOptions: Parameters<typeof verifyToken>[1] = audience
      ? { secretKey, audience }
      : { secretKey };

    const claims = await verifyToken(token, verifyOptions);

    return NextResponse.json(
      {
        ok: true,
        claims,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: 'Invalid or expired token' },
      { status: 401 },
    );
  }
}


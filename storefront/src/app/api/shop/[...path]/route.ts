/**
 * Browser → storefront → Express.
 *
 * Everything the client does goes through here so the shopper's access and
 * refresh tokens can live in httpOnly cookies, out of reach of any script on
 * the page. It also means the browser never learns the API's address and there
 * is no CORS surface to get wrong.
 *
 * The cart token round-trips the same way: the API returns it in `meta`, and
 * this sets it as a cookie so an anonymous shopper keeps their bag.
 */
import { NextRequest, NextResponse } from 'next/server';
import { API_BASE, COOKIE } from '@/lib/config';

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade']);

async function proxy(req: NextRequest, path: string[]) {
  const target = `${API_BASE}/${path.join('/')}${req.nextUrl.search}`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const access = req.cookies.get(COOKIE.access)?.value;
  const cart = req.cookies.get(COOKIE.cart)?.value;
  if (access) headers.Authorization = `Bearer ${access}`;
  if (cart) headers['X-Cart-Token'] = cart;

  const body =
    req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text();

  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body,
    cache: 'no-store',
  });

  const payload = await upstream.json().catch(() => ({
    success: false,
    error: 'The shop is not responding. Please try again.',
  }));

  const res = NextResponse.json(payload, { status: upstream.status });

  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase()) && key.toLowerCase() !== 'content-length') {
      // Deliberately not forwarding upstream Set-Cookie: this app owns cookies.
    }
  });

  // Persist the cart token the API handed back.
  if (payload?.meta?.cartToken && payload.meta.cartToken !== cart) {
    res.cookies.set(COOKIE.cart, payload.meta.cartToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  // Sign-in and refresh hand back tokens; they never reach the page.
  if (payload?.success && payload?.data?.accessToken && payload?.data?.refreshToken) {
    const secure = process.env.NODE_ENV === 'production';
    res.cookies.set(COOKIE.access, payload.data.accessToken, {
      httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 30,
    });
    res.cookies.set(COOKIE.refresh, payload.data.refreshToken, {
      httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 60 * 24 * 30,
    });
    // Strip them from the response body — the page has no use for them.
    delete payload.data.accessToken;
    delete payload.data.refreshToken;
    return NextResponse.json(payload, { status: upstream.status, headers: res.headers });
  }

  if (path.join('/') === 'auth/logout') {
    res.cookies.delete(COOKIE.access);
    res.cookies.delete(COOKIE.refresh);
  }

  return res;
}

export async function GET(req: NextRequest, ctx: { params: { path: string[] } }) {
  return proxy(req, ctx.params.path);
}
export async function POST(req: NextRequest, ctx: { params: { path: string[] } }) {
  return proxy(req, ctx.params.path);
}
export async function PATCH(req: NextRequest, ctx: { params: { path: string[] } }) {
  return proxy(req, ctx.params.path);
}
export async function PUT(req: NextRequest, ctx: { params: { path: string[] } }) {
  return proxy(req, ctx.params.path);
}
export async function DELETE(req: NextRequest, ctx: { params: { path: string[] } }) {
  return proxy(req, ctx.params.path);
}

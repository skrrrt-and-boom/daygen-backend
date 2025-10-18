export interface JwtPayload {
  sub: string;
  authUserId?: string;
  email: string;
  iat?: number;
  exp?: number;
  aud?: string;
  iss?: string;
  role?: string;
}

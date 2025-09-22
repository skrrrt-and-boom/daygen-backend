export interface CreateLocalUserInput {
  email: string;
  passwordHash: string;
  displayName?: string;
}

export interface SanitizedUser {
  id: string;
  authUserId: string;
  email: string;
  displayName: string | null;
  credits: number;
  profileImage: string | null;
  role: 'USER' | 'ADMIN';
  createdAt: Date;
  updatedAt: Date;
}

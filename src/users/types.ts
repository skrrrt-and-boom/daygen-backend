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
  createdAt: Date;
  updatedAt: Date;
}

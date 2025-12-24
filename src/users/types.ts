export interface CreateLocalUserInput {
  email: string;
  displayName?: string;
}

export interface SanitizedUser {
  id: string;
  authUserId: string;
  email: string;
  username: string | null;
  displayName: string | null;
  credits: number;
  profileImage: string | null;
  bio?: string | null;
  country?: string | null;
  role: 'USER' | 'ADMIN';
  createdAt: Date;
  updatedAt: Date;
  subscription?: {
    id: string;
    status: string;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
    createdAt: Date;
  } | null;
}

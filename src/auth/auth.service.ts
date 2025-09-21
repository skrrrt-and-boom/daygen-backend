import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { SignUpDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { UsersService } from '../users/users.service';
import { JwtPayload } from './jwt.types';
import { SanitizedUser } from '../users/types';

export interface AuthResult {
  accessToken: string;
  user: SanitizedUser;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async signUp(dto: SignUpDto): Promise<AuthResult> {
    const existing = await this.usersService.findByEmailWithSecret(dto.email);
    if (existing) {
      throw new ConflictException('Email is already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.usersService.createLocalUser({
      email: dto.email,
      passwordHash,
      displayName: dto.displayName,
    });

    const safeUser = this.usersService.toSanitizedUser(user);
    const token = await this.buildToken(safeUser);

    return { accessToken: token, user: safeUser };
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.usersService.findByEmailWithSecret(dto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const safeUser = this.usersService.toSanitizedUser(user);
    const token = await this.buildToken(safeUser);

    return { accessToken: token, user: safeUser };
  }

  async getProfile(userId: string): Promise<SanitizedUser> {
    const user = await this.usersService.findById(userId);
    return this.usersService.toSanitizedUser(user);
  }

  private buildToken(user: SanitizedUser): Promise<string> {
    const payload: JwtPayload = {
      sub: user.id,
      authUserId: user.authUserId,
      email: user.email,
    };

    return this.jwtService.signAsync(payload);
  }
}

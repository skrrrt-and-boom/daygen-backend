#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Fix unused variables and other issues
const fixes = [
  {
    file: 'src/auth/auth.service.ts',
    changes: [
      { from: "import { ConflictException,", to: "import {" },
      { from: "  UnauthorizedException,", to: "" },
      { from: "import { PrismaClientKnownRequestError, User } from '@prisma/client';", to: "" },
      { from: "async signUp(dto: SignUpDto) {", to: "signUp(_dto: SignUpDto) {" },
      { from: "async login(dto: LoginDto) {", to: "login(_dto: LoginDto) {" }
    ]
  },
  {
    file: 'src/auth/jwt.strategy.ts',
    changes: [
      { from: "    } catch (error) {", to: "    } catch {" }
    ]
  },
  {
    file: 'src/auth/supabase-auth.service.ts',
    changes: [
      { from: "    const { accessToken } = await this.supabaseService", to: "    await this.supabaseService" }
    ]
  },
  {
    file: 'src/users/users.service.ts',
    changes: [
      { from: "async updatePassword(userId: string, passwordHash: string) {", to: "updatePassword(_userId: string, _passwordHash: string) {" }
    ]
  }
];

fixes.forEach(({ file, changes }) => {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    changes.forEach(({ from, to }) => {
      content = content.replace(from, to);
    });
    
    fs.writeFileSync(filePath, content);
    console.log(`Fixed ${file}`);
  }
});

console.log('Backend lint fixes applied!');

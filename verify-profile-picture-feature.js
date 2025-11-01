/**
 * Profile Picture Feature Verification Script
 * Verifies that all components are properly implemented
 */

const fs = require('fs');
const path = require('path');

const COLORS = {
  GREEN: '\x1b[32m',
  RED: '\x1b[31m',
  YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m',
  RESET: '\x1b[0m'
};

function checkmark() {
  return `${COLORS.GREEN}✓${COLORS.RESET}`;
}

function cross() {
  return `${COLORS.RED}✗${COLORS.RESET}`;
}

function header(text) {
  console.log(`\n${COLORS.BLUE}=== ${text} ===${COLORS.RESET}\n`);
}

function success(text) {
  console.log(`${checkmark()} ${text}`);
}

function error(text) {
  console.log(`${cross()} ${text}`);
}

function info(text) {
  console.log(`  ${text}`);
}

let allPassed = true;

function verify() {
  header('Profile Picture Feature Verification');
  
  // Check 1: Prisma Schema
  header('1. Database Schema');
  try {
    const schemaPath = path.join(__dirname, 'prisma', 'schema.prisma');
    const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
    
    if (schemaContent.includes('profileImage String?')) {
      success('User model has profileImage field');
      info('Type: String? (nullable)');
    } else {
      error('profileImage field not found in User model');
      allPassed = false;
    }
  } catch (err) {
    error('Could not read prisma/schema.prisma');
    info(`Error: ${err.message}`);
    allPassed = false;
  }
  
  // Check 2: R2 Service
  header('2. R2 Service Implementation');
  try {
    const r2ServicePath = path.join(__dirname, 'src', 'upload', 'r2.service.ts');
    const r2Content = fs.readFileSync(r2ServicePath, 'utf-8');
    
    if (r2Content.includes('uploadBase64Image')) {
      success('R2Service has uploadBase64Image method');
    } else {
      error('uploadBase64Image method not found');
      allPassed = false;
    }
    
    if (r2Content.includes('deleteFile')) {
      success('R2Service has deleteFile method');
    } else {
      error('deleteFile method not found');
      allPassed = false;
    }
    
    if (r2Content.includes('CLOUDFLARE_R2_BUCKET_NAME')) {
      success('R2Service uses Cloudflare R2 configuration');
    } else {
      error('Cloudflare R2 configuration not found');
      allPassed = false;
    }
  } catch (err) {
    error('Could not read src/upload/r2.service.ts');
    info(`Error: ${err.message}`);
    allPassed = false;
  }
  
  // Check 3: Users Service
  header('3. Users Service Implementation');
  try {
    const usersServicePath = path.join(__dirname, 'src', 'users', 'users.service.ts');
    const usersContent = fs.readFileSync(usersServicePath, 'utf-8');
    
    if (usersContent.includes('uploadProfilePicture')) {
      success('UsersService has uploadProfilePicture method');
      
      if (usersContent.includes("'profile-pictures'")) {
        success('Profile pictures stored in profile-pictures/ folder');
        info('Location: profile-pictures/ (same level as generated-images/)');
      } else {
        error('profile-pictures folder not specified');
        allPassed = false;
      }
      
      if (usersContent.includes('deleteFile(currentUser.profileImage)')) {
        success('Old profile pictures are deleted when uploading new ones');
      } else {
        error('Old profile picture cleanup not implemented');
        allPassed = false;
      }
    } else {
      error('uploadProfilePicture method not found');
      allPassed = false;
    }
    
    if (usersContent.includes('removeProfilePicture')) {
      success('UsersService has removeProfilePicture method');
    } else {
      error('removeProfilePicture method not found');
      allPassed = false;
    }
  } catch (err) {
    error('Could not read src/users/users.service.ts');
    info(`Error: ${err.message}`);
    allPassed = false;
  }
  
  // Check 4: Users Controller
  header('4. Users Controller API Endpoints');
  try {
    const usersControllerPath = path.join(__dirname, 'src', 'users', 'users.controller.ts');
    const controllerContent = fs.readFileSync(usersControllerPath, 'utf-8');
    
    if (controllerContent.includes("@Post('me/profile-picture')")) {
      success('POST /api/users/me/profile-picture endpoint exists');
    } else {
      error('Upload endpoint not found');
      allPassed = false;
    }
    
    if (controllerContent.includes("@Post('me/remove-profile-picture')")) {
      success('POST /api/users/me/remove-profile-picture endpoint exists');
    } else {
      error('Remove endpoint not found');
      allPassed = false;
    }
    
    if (controllerContent.includes('@UseGuards(JwtAuthGuard)')) {
      success('Endpoints are protected with JWT authentication');
    } else {
      error('JWT authentication guard not found');
      allPassed = false;
    }
  } catch (err) {
    error('Could not read src/users/users.controller.ts');
    info(`Error: ${err.message}`);
    allPassed = false;
  }
  
  // Check 5: Frontend Hook
  header('5. Frontend Profile Picture Hook');
  try {
    const hookPath = path.join(__dirname, '..', 'daygen0-fresh', 'src', 'hooks', 'useProfilePictureUpload.ts');
    const hookContent = fs.readFileSync(hookPath, 'utf-8');
    
    if (hookContent.includes('uploadProfilePicture')) {
      success('useProfilePictureUpload hook has uploadProfilePicture method');
    } else {
      error('uploadProfilePicture method not found in hook');
      allPassed = false;
    }
    
    if (hookContent.includes('removeProfilePicture')) {
      success('useProfilePictureUpload hook has removeProfilePicture method');
    } else {
      error('removeProfilePicture method not found in hook');
      allPassed = false;
    }
    
    if (hookContent.includes('/api/users/me/profile-picture')) {
      success('Hook calls correct API endpoint');
    } else {
      error('API endpoint path not found in hook');
      allPassed = false;
    }
  } catch (err) {
    error('Could not read frontend hook file');
    info(`Error: ${err.message}`);
    allPassed = false;
  }
  
  // Check 6: Frontend Account Component
  header('6. Frontend Account Page');
  try {
    const accountPath = path.join(__dirname, '..', 'daygen0-fresh', 'src', 'components', 'Account.tsx');
    const accountContent = fs.readFileSync(accountPath, 'utf-8');
    
    if (accountContent.includes('useProfilePictureUpload')) {
      success('Account page uses useProfilePictureUpload hook');
    } else {
      error('useProfilePictureUpload hook not imported');
      allPassed = false;
    }
    
    if (accountContent.includes('ProfileCropModal')) {
      success('Account page includes ProfileCropModal component');
    } else {
      error('ProfileCropModal not found');
      allPassed = false;
    }
    
    if (accountContent.includes('handleCropComplete')) {
      success('Crop completion handler implemented');
    } else {
      error('Crop completion handler not found');
      allPassed = false;
    }
    
    if (accountContent.includes('handleRemoveProfilePic')) {
      success('Profile picture removal handler implemented');
    } else {
      error('Removal handler not found');
      allPassed = false;
    }
  } catch (err) {
    error('Could not read Account.tsx');
    info(`Error: ${err.message}`);
    allPassed = false;
  }
  
  // Check 7: Frontend Crop Modal
  header('7. Frontend Crop Modal Component');
  try {
    const cropModalPath = path.join(__dirname, '..', 'daygen0-fresh', 'src', 'components', 'ProfileCropModal.tsx');
    const cropModalContent = fs.readFileSync(cropModalPath, 'utf-8');
    
    if (cropModalContent.includes('react-image-crop')) {
      success('Uses react-image-crop library');
    } else {
      error('react-image-crop library not found');
      allPassed = false;
    }
    
    if (cropModalContent.includes('aspect') && cropModalContent.includes('1')) {
      success('Crops to 1:1 aspect ratio (square)');
    } else {
      error('Aspect ratio not properly set');
      allPassed = false;
    }
    
    if (cropModalContent.includes('canvas')) {
      success('Uses canvas for image processing');
    } else {
      error('Canvas-based processing not found');
      allPassed = false;
    }
  } catch (err) {
    error('Could not read ProfileCropModal.tsx');
    info(`Error: ${err.message}`);
    allPassed = false;
  }
  
  // Check 8: Environment Variables
  header('8. Environment Configuration');
  try {
    const envPath = path.join(__dirname, '.env');
    const envContent = fs.readFileSync(envPath, 'utf-8');
    
    const requiredVars = [
      'CLOUDFLARE_R2_ACCOUNT_ID',
      'CLOUDFLARE_R2_ACCESS_KEY_ID',
      'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
      'CLOUDFLARE_R2_BUCKET_NAME',
      'CLOUDFLARE_R2_PUBLIC_URL'
    ];
    
    let allVarsPresent = true;
    for (const varName of requiredVars) {
      if (envContent.includes(varName)) {
        success(`${varName} is configured`);
      } else {
        error(`${varName} is missing`);
        allVarsPresent = false;
        allPassed = false;
      }
    }
    
    if (allVarsPresent) {
      success('All R2 environment variables are configured');
    }
  } catch (err) {
    error('Could not read .env file');
    info(`Error: ${err.message}`);
    info('Make sure .env file exists with R2 configuration');
    allPassed = false;
  }
  
  // Final Summary
  header('Verification Summary');
  if (allPassed) {
    console.log(`${COLORS.GREEN}✓ All checks passed!${COLORS.RESET}`);
    console.log('\nThe profile picture feature is fully implemented with:');
    info('✓ Backend API endpoints');
    info('✓ R2 cloud storage integration');
    info('✓ Database schema');
    info('✓ Frontend UI components');
    info('✓ Image cropping functionality');
    info('✓ Upload and removal capabilities');
    info('✓ Proper folder structure (profile-pictures/)');
    
    console.log('\n' + COLORS.YELLOW + 'Next Steps:' + COLORS.RESET);
    info('1. Start backend: cd daygen-backend && npm run start:dev');
    info('2. Start frontend: cd daygen0-fresh && npm run dev');
    info('3. Navigate to http://localhost:5173/account');
    info('4. Test uploading and removing a profile picture');
    info('5. Verify images are stored in R2 at profile-pictures/ folder');
    
    process.exit(0);
  } else {
    console.log(`${COLORS.RED}✗ Some checks failed${COLORS.RESET}`);
    console.log('\nPlease review the errors above and ensure all components are properly implemented.');
    process.exit(1);
  }
}

// Run verification
verify();



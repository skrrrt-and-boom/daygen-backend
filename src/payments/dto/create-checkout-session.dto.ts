import { IsString, IsEnum, IsNotEmpty } from 'class-validator';

export class CreateCheckoutSessionDto {
    @IsEnum(['one_time', 'subscription'])
    type: 'one_time' | 'subscription';

    @IsString()
    @IsNotEmpty()
    packageId: string;
}

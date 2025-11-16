import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UsageEventsQueryDto {
  @IsOptional()
  @IsString()
  userAuthId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  cursor?: string;
}

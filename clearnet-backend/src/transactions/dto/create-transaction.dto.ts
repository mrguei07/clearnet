import { IsEmail, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateTransactionDto {
  @IsEmail()
  toEmail!: string;

  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(0.00000001)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  note?: string;
}

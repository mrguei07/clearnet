import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsNotEmpty()
  @MinLength(2)
  name!: string;

  @MinLength(6, { message: 'Le mot de passe doit contenir au moins 6 caractères' })
  password!: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsIn(['SupplyChain', 'RealEstate', 'Energy', 'Banking', 'Metallurgy', 'Healthcare', 'Fashion', 'IndustrialTextile', 'Defense', 'Technology', 'InternationalTrade', 'Aviation', 'Maritime', 'Spatial', 'Biotech'])
  industry?: string;
}

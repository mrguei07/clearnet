import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

/**
 * Événement d'ingestion ERP (Phase A — Gateway connecteurs).
 * source = ERP émetteur ; externalId = identifiant métier dans l'ERP
 * (idempotence : source+externalId uniques).
 */
export class IngestEventDto {
  @IsIn(['SAP', 'ORACLE', 'DYNAMICS', 'ODOO'])
  source!: string;

  @IsString()
  @IsNotEmpty()
  externalId!: string;

  @IsString()
  @IsNotEmpty()
  fromCompany!: string;

  @IsString()
  @IsNotEmpty()
  toCompany!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  invoiceRef?: string;

  @IsOptional()
  @IsString()
  dueDate?: string;
}

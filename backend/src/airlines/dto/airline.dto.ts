import { ApiProperty } from '@nestjs/swagger';
import { CancellationTierDto } from '../../common/helpers/cancellation-tiers';

// Response shape, used only for Swagger documentation (FLT-01).
export class AirlineDto {
  @ApiProperty({ example: '6735a1f4c1a2b3c4d5e6f701' })
  _id: string;

  @ApiProperty({ example: 'TEST Nile Air' })
  name: string;

  @ApiProperty({ example: 'NP' })
  code: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Logo URL (GEN-08), or null',
  })
  logo: string | null;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: null,
    description: 'USD cents per extra bag (FLT-08), null until set',
  })
  extraBagPrice: number | null;

  @ApiProperty({ example: 0 })
  maxExtraBags: number;

  @ApiProperty({ type: [CancellationTierDto], example: [] })
  cancellationTiers: CancellationTierDto[];

  @ApiProperty({ example: '2026-11-14T10:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-11-14T10:00:00.000Z' })
  updatedAt: string;
}

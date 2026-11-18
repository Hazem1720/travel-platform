import { ApiProperty } from '@nestjs/swagger';

// Response shape, used only for Swagger documentation.
export class ActivityViewDto {
  @ApiProperty({ example: '6735a1f4c1a2b3c4d5e6fb01' })
  _id: string;

  @ApiProperty({ example: '6735a1f4c1a2b3c4d5e6f901' })
  itineraryId: string;

  @ApiProperty({ example: '6735a1f4c1a2b3c4d5e6fa01' })
  dayId: string;

  @ApiProperty({ example: 'Visit the Egyptian Museum' })
  name: string;

  @ApiProperty({ example: 'Tickets at the gate' })
  description: string;

  @ApiProperty({ example: '10:30', nullable: true })
  time: string | null;

  @ApiProperty({
    example: { amount: 250, currency: 'EGP' },
    nullable: true,
  })
  cost: { amount: number; currency: string } | null;

  @ApiProperty({ type: [String], example: [] })
  images: string[];
}

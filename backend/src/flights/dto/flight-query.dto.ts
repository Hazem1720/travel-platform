import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import { FlightStatus } from '../schemas/flight.schema';

export class FlightQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: FlightStatus, example: FlightStatus.SCHEDULED })
  @IsOptional()
  @IsEnum(FlightStatus)
  status?: FlightStatus;
}

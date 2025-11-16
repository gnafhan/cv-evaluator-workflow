import { IsString, IsNotEmpty } from 'class-validator';

export class EvaluateRequestDto {
  @IsString()
  @IsNotEmpty()
  job_title: string;

  @IsString()
  @IsNotEmpty()
  cv_id: string;

  @IsString()
  @IsNotEmpty()
  project_report_id: string;
}


import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class SendEmailDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500) // generous cap; real subject-line limits are much lower but
  // this only needs to reject pathological input, not enforce email-client UX
  subject: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200000) // ~200KB of HTML -- generous cap for a marketing/notice email
  html: string;
}

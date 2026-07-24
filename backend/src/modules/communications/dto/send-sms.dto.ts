import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class SendSmsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1600) // Twilio's own hard cap on a single concatenated SMS body
  body: string;
}

import {
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Body of `POST /agent/execute`.
 *
 * These fields were previously bound one at a time with `@Body('toolName')`.
 * That form takes the property straight off the parsed body and hands it to the
 * handler, so the global ValidationPipe -- which validates the DTO bound to the
 * WHOLE body -- never saw them. The observable consequence was a misleading
 * status code: omitting `toolName` produced 404 "Tool undefined not found"
 * rather than 400, telling the caller the tool was missing when the request was
 * malformed. Binding the whole body to a class restores validation.
 */
export class ExecuteToolDto {
  @IsString({ message: 'toolName must be a string' })
  @MinLength(1, { message: 'toolName must not be empty' })
  @MaxLength(100)
  toolName: string;

  /**
   * Deliberately `@IsObject` and not a typed shape: each tool defines its own
   * arguments, and the handler validates what it needs. What is enforced here
   * is that a caller cannot smuggle a string or an array in where the tool will
   * dereference properties -- `'all of them'.query` is `undefined`, which used
   * to sail through as an empty search.
   */
  @IsOptional()
  @IsObject({ message: 'arguments must be an object' })
  arguments?: Record<string, unknown>;

  @IsOptional()
  @IsString({ message: 'sessionId must be a string' })
  @MaxLength(200)
  sessionId?: string;
}

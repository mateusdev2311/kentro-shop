import { Controller, Get } from '@nestjs/common';

@Controller()
export class SaudeController {
  @Get()
  verificar(): { ok: true } {
    return { ok: true };
  }
}

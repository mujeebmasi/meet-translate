import { Controller, Get } from '@nestjs/common';
import { accessCodeRequired } from './access-code';

// GET /api/config -- what the home page needs to know before showing its
// form (whether creating a meeting asks for an access code). Also used by
// deploy/start-local.sh to tell when the server is up.
@Controller('config')
export class ConfigController {
  @Get()
  get() {
    return { accessCodeRequired: accessCodeRequired() };
  }
}

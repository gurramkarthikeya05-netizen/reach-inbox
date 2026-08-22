import type { UserDto } from '@reachinbox/contracts';

declare global {
  namespace Express {
    interface User extends UserDto {}
  }
}

export {};
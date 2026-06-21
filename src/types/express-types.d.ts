import "express-serve-static-core";

declare module "express-serve-static-core" {
  interface Request {
    requestId?: string;
    startAt?: number;
    authUser?: {
      userId: string;
      email: string;
      name: string;
      picture?: string;
    };
  }
}
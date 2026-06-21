import { DatabaseConnPools } from "../types/custom-types";
import { Connection } from "mongoose";
import { UserRepository } from "../features/user/user.repository";
import { UserService } from "../features/user/user.service";
import { UserController } from "../features/user/user.controller";

export function buildUserModule(dbConnPool:DatabaseConnPools<Connection>) {
    const userRepo = new UserRepository(dbConnPool['primary']);
    
      const service = new UserService(userRepo)
      const controller = new UserController(service);
      return {
        "userController":controller
      }
}
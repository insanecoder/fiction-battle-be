import type { Request, Response, NextFunction } from "express";
import { UserService } from "./user.service";

export class UserController {
  constructor(private readonly userService: UserService) {}

  createUser = async (req: Request, res: Response, next: NextFunction) => {
    const userId = await this.userService.createUser(req.body)
    return res.status(201).json({
        data: {userId},
        requestId: req.requestId,
    });   
  };
}
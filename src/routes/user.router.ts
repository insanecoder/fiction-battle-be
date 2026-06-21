import { Router } from "express";
import { validate } from "../lib/http/validate";
import { AppDependencies, UserModule } from "../types/custom-types";
import { createUserSchema } from "../validations/user.schema";

export function userRouter(userModule:UserModule): Router {
  const router = Router();

  router.post(
    "/create",
    validate(createUserSchema, "body"),
    userModule['userController'].createUser
  );

  return router;
}
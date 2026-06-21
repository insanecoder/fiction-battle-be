import { UserRepository } from "./user.repository";
import type { CreateUserInput } from "../../validations/user.schema";


export class UserService {
  constructor(private readonly userRepo: UserRepository) {}

  async createUser(input: CreateUserInput) {
    return await this.userRepo.findOrCreate(input);
  }
}
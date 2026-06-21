import type { Request, Response, NextFunction } from "express";
import { TagService } from "./tag.service";
import { TagType } from "../../types/custom-types";

export class TagController {
  constructor(private readonly tagService: TagService) {}


  searchTags = async (req: Request, res: Response, next: NextFunction) => {
    const search   = (req.query.q as string | undefined)?.trim() ?? "";
    const type     = req.query.type as TagType;
    const universe = req.query.universe as string | undefined;
    const tags = await this.tagService.searchTags(search, type, universe);
    return res.status(200).json({ data: tags, requestId: req.requestId });
  };
}

import { Request, Response } from "express";
import * as appConfigService from "./app-config.service";

// Public configs allowed to be fetched without auth
const PUBLIC_CONFIG_KEYS = ["homepage_faqs", "homepage_metrics", "require_admin_approval_tags", "announcement_limits", "enable_student_chat", "homepage_timeline"];

export async function getPublicConfigHandler(req: Request, res: Response) {
  try {
    const { key } = req.params;
    if (!PUBLIC_CONFIG_KEYS.includes(key)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const data = await appConfigService.getAppConfig(key);
    res.json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function listConfigsHandler(req: Request, res: Response) {
  try {
    const data = await appConfigService.listAppConfigs();
    res.json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function getConfigHandler(req: Request, res: Response) {
  try {
    const { key } = req.params;
    const data = await appConfigService.getAppConfig(key);
    res.json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function updateConfigHandler(req: Request, res: Response) {
  try {
    const { key } = req.params;
    const { value } = req.body;
    const updatedBy = req.authUser?.id;
    
    if (value === undefined) {
      return res.status(400).json({ success: false, message: "Value is required" });
    }

    const data = await appConfigService.upsertAppConfig(key, value, updatedBy);
    res.json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

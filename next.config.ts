import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "unpdf", "mammoth", "bcryptjs"],
};

export default nextConfig;

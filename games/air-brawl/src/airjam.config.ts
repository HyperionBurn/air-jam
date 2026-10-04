/**
 * Air Jam app config for Air Brawl: runtime topology, controller path, the
 * controller input schema, and the semantic agent contract used by MCP sessions.
 */
import { createAirJamApp, env } from "@air-jam/sdk";
import { defineAirJamGameMetadata } from "@air-jam/sdk/metadata";
import { agentContract } from "./game/contracts/agent";
import { gameInputSchema } from "./game/net/input-codec";

export const gameMetadata = defineAirJamGameMetadata({
  slug: "air-brawl",
  name: "Air Brawl",
  tagline:
    "Original party platform fighter for 2–8 players. Percent damage, blast zones, four fighters, three stages, phones as controllers.",
  category: "arcade",
  minPlayers: 1,
  maxPlayers: 8,
  inputModalities: ["buttons", "joystick", "touch"],
  supportedSdkRange: "^1.0.0",
  maintainer: { name: "Air Jam" },
  ageRating: "all-ages",
  tags: ["fighting", "platformer", "party", "action", "canvas"],
});

export const airjam = createAirJamApp({
  runtime: env.vite(import.meta.env),
  metadata: gameMetadata,
  controllerPath: "/controller",
  agent: agentContract,
  input: {
    schema: gameInputSchema,
  },
});

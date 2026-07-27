-- A player's name is now something they choose rather than something assigned to them.
ALTER TABLE "Player" ADD COLUMN "named" BOOLEAN NOT NULL DEFAULT false;

-- Anyone whose name is not the exact placeholder this server hands out at sign-in
-- (TRADER + the last four characters of their address) chose it themselves, so they must
-- not be marched back through the naming screen.
UPDATE "Player"
   SET "named" = true
 WHERE "name" <> 'TRADER' || upper(right("address", 4));

-- Reparación única del esquema de la Sala en Neon (base impuldata_estado) · ORG-2026-030 · 29-oct
-- storyboard_projects ya existía con otro esquema (id, encargo_code, piece_name, client_name, status, created_at)
-- y una fila. Se le agregan las columnas que usa la Sala sin borrar nada.
-- Las otras tres tablas tenían 0 filas: se eliminan SOLO si siguen vacías y el arranque de la app
-- (migrate) las vuelve a crear con el esquema correcto. Todo va en una transacción: si algo falla, no cambia nada.

BEGIN;

ALTER TABLE storyboard_projects
  ADD COLUMN IF NOT EXISTS share_slug text,
  ADD COLUMN IF NOT EXISTS intro_message text,
  ADD COLUMN IF NOT EXISTS idea_angle text,
  ADD COLUMN IF NOT EXISTS idea_audience text,
  ADD COLUMN IF NOT EXISTS color_palette_notes text,
  ADD COLUMN IF NOT EXISTS typography_notes text,
  ADD COLUMN IF NOT EXISTS current_tier_label text,
  ADD COLUMN IF NOT EXISTS current_tier_description text,
  ADD COLUMN IF NOT EXISTS next_tier_label text,
  ADD COLUMN IF NOT EXISTS next_tier_description text,
  ADD COLUMN IF NOT EXISTS max_review_rounds integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- La columna status no la llena la Sala: se le da un valor por defecto para que el seed pueda insertar.
ALTER TABLE storyboard_projects ALTER COLUMN status SET DEFAULT 'activo';
ALTER TABLE storyboard_projects ALTER COLUMN created_at SET DEFAULT now();

-- El seed usa ON CONFLICT (encargo_code) y la revisión busca por share_slug.
CREATE UNIQUE INDEX IF NOT EXISTS ux_storyboard_projects_encargo_code ON storyboard_projects(encargo_code);
CREATE UNIQUE INDEX IF NOT EXISTS ux_storyboard_projects_share_slug ON storyboard_projects(share_slug);

DO $$
BEGIN
  IF (SELECT count(*) FROM scene_reviews) > 0
     OR (SELECT count(*) FROM approval_rounds) > 0
     OR (SELECT count(*) FROM storyboard_scenes) > 0 THEN
    RAISE EXCEPTION 'Las tablas de escenas, rondas o revisiones ya tienen datos: no se borra nada.';
  END IF;
END $$;

-- Sin CASCADE a propósito: si otra tabla depende de estas, falla y la transacción se revierte.
DROP TABLE scene_reviews;
DROP TABLE approval_rounds;
DROP TABLE storyboard_scenes;

COMMIT;

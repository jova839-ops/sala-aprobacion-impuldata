const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL no está configurada.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
});

async function migrate() {
  await pool.query(`
    DO $$ BEGIN
      CREATE TYPE scene_role AS ENUM ('gancho','desarrollo','mensaje','cierre_y_llamado_a_la_accion');
    EXCEPTION WHEN duplicate_object THEN null; END $$;

    DO $$ BEGIN
      CREATE TYPE review_decision AS ENUM ('aprobado','ajuste_solicitado');
    EXCEPTION WHEN duplicate_object THEN null; END $$;

    DO $$ BEGIN
      CREATE TYPE round_status AS ENUM ('abierta','bloqueada');
    EXCEPTION WHEN duplicate_object THEN null; END $$;

    CREATE TABLE IF NOT EXISTS storyboard_projects (
      id serial primary key,
      encargo_code text not null unique,
      piece_name text not null,
      client_name text not null,
      share_slug text not null unique,
      intro_message text,
      idea_angle text,
      idea_audience text,
      color_palette_notes text,
      typography_notes text,
      current_tier_label text,
      current_tier_description text,
      next_tier_label text,
      next_tier_description text,
      max_review_rounds integer not null default 2,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    CREATE TABLE IF NOT EXISTS storyboard_scenes (
      id serial primary key,
      project_id integer not null references storyboard_projects(id) on delete cascade,
      scene_number integer not null,
      scene_title text not null,
      scene_role scene_role not null,
      image_path text not null,
      seconds_start numeric(5,2) not null,
      seconds_end numeric(5,2) not null,
      intended_feeling text not null,
      artistic_reasoning text not null,
      created_at timestamptz not null default now(),
      unique(project_id, scene_number)
    );

    CREATE TABLE IF NOT EXISTS approval_rounds (
      id serial primary key,
      project_id integer not null references storyboard_projects(id) on delete cascade,
      round_number integer not null,
      status round_status not null default 'abierta',
      submitted_at timestamptz,
      created_at timestamptz not null default now(),
      unique(project_id, round_number)
    );

    CREATE TABLE IF NOT EXISTS scene_reviews (
      id serial primary key,
      round_id integer not null references approval_rounds(id) on delete cascade,
      scene_id integer not null references storyboard_scenes(id) on delete cascade,
      decision review_decision not null,
      comment text,
      created_at timestamptz not null default now(),
      unique(round_id, scene_id)
    );

    CREATE INDEX IF NOT EXISTS idx_storyboard_scenes_project ON storyboard_scenes(project_id);
    CREATE INDEX IF NOT EXISTS idx_approval_rounds_project ON approval_rounds(project_id);
    CREATE INDEX IF NOT EXISTS idx_scene_reviews_round ON scene_reviews(round_id);
  `);
}

module.exports = { pool, migrate };

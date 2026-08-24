import type { D1Database } from '@cloudflare/workers-types';

export interface EmailCredentialRow {
  id: number;
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password_ciphertext: string;
  encryption_key_version: number;
  from_email: string;
  updated_at: string;
}

export async function getEmailCredential(db: D1Database): Promise<EmailCredentialRow | null> {
  return db.prepare('SELECT * FROM email_credentials WHERE id = 1').first<EmailCredentialRow>();
}

export async function saveEmailCredential(
  db: D1Database,
  data: { smtp_host: string; smtp_port: number; smtp_username: string; ciphertext: string; from_email: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO email_credentials (id, smtp_host, smtp_port, smtp_username, smtp_password_ciphertext, encryption_key_version, from_email, updated_at)
       VALUES (1, ?, ?, ?, ?, 1, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         smtp_host = excluded.smtp_host,
         smtp_port = excluded.smtp_port,
         smtp_username = excluded.smtp_username,
         smtp_password_ciphertext = excluded.smtp_password_ciphertext,
         from_email = excluded.from_email,
         updated_at = excluded.updated_at`,
    )
    .bind(data.smtp_host, data.smtp_port, data.smtp_username, data.ciphertext, data.from_email)
    .run();
}

export async function deleteEmailCredential(db: D1Database): Promise<void> {
  await db.prepare('DELETE FROM email_credentials WHERE id = 1').run();
}
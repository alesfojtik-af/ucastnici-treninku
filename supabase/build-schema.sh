#!/bin/sh
# Sestaví schema.sql (pro NOVOU prázdnou databázi) slepením migrací v pořadí. Spusťte po každé nové migraci:
#   sh supabase/build-schema.sh
# Existující databázi tím neobnovujte, tam se spouští jen nové migrace (viz README).
cd "$(dirname "$0")" || exit 1
{
  echo "-- GENEROVÁNO skriptem build-schema.sh ze souborů v migrations/. Needitovat ručně."
  echo "-- Pro novou prázdnou databázi: spusťte celý soubor v Supabase SQL Editoru."
  for f in migrations/*.sql; do printf '\n-- ===== %s =====\n' "$f"; cat "$f"; done
} > schema.sql

#!/bin/bash
# Runs once, on first Postgres start. One database per service — services never
# share a schema, so a migration in one cannot break another.
set -e

for db in ssm_identity ssm_financial ssm_hr ssm_operations; do
  echo "creating database $db"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-SQL
    CREATE DATABASE $db;
    \connect $db
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
SQL
done

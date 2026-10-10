const path = require('path');
const fs = require('fs');
const { Sequelize } = require('sequelize');

const dialect = process.env.DB_DIALECT || 'sqlite';
let sequelize;

if (process.env.DATABASE_URL) {
  // One connection string (Railway, Render, Neon, PlanetScale…): mysql://… or postgres://…
  const ssl = process.env.DB_SSL === '1';
  sequelize = new Sequelize(process.env.DATABASE_URL, {
    logging: false,
    dialectOptions: ssl ? { ssl: { require: true, rejectUnauthorized: false } } : {},
    pool: { max: 10, min: 0, idle: 10000 },
  });
} else if (dialect === 'mysql') {
  sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASS, {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    dialect: 'mysql',
    logging: false,
    timezone: '+05:30',
    pool: { max: 10, min: 0, idle: 10000 },
  });
} else {
  const storage = path.resolve(__dirname, '../..', process.env.DB_STORAGE || './data/orbit.sqlite');
  fs.mkdirSync(path.dirname(storage), { recursive: true });
  sequelize = new Sequelize({ dialect: 'sqlite', storage, logging: false });
}

module.exports = sequelize;

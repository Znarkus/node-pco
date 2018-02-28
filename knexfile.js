
module.exports = {

  development: {
    client: 'postgresql',
    connection: process.env.DATABASE_URL || {
      database: 'pco',
      user:     'postgres',
      password: 'postgres'
    },
    migrations: {
      tableName: '_migrations'
    }
  },

  staging: {
    client: 'postgresql',
    connection: process.env.DATABASE_URL,
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      tableName: '_migrations'
    }
  },

  production: {
    client: 'postgresql',
    connection: process.env.DATABASE_URL,
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      tableName: '_migrations'
    }
  }

};


exports.up = function(knex, Promise) {
  return knex.schema.createTable('emails', t => {
    t.increments()
    t.integer('day').defaultTo(10).notNullable()
    t.specificType('service_types', 'integer[]').defaultTo('{}').notNullable()
    t.specificType('teams', 'text[]').defaultTo('{}').notNullable()
    t.string('email').notNullable()
    t.boolean('is_enabled').defaultTo(true).notNullable()
  })
};

exports.down = function(knex, Promise) {
  return kenx.schema.dropTable('email')
};

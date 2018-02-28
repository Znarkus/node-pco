
exports.up = function(knex, Promise) {
  return knex.schema.table('emails', t => {
    t.text('last_html')
  })
};

exports.down = function(knex, Promise) {
  return knex.schema.table('emails', t => {
    t.dropColumn('last_html')
  })
};

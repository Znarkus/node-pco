'use strict'

global.Promise = require('bluebird')

const fs = require('fs')
const request = require('request-promise')
const moment = require('moment')
const { sortBy } = require('lodash')
const nunjucks = require('nunjucks')
const nunjucksDateFilter = require('nunjucks-date-filter')
const Knex = require('knex')
const Mailgun = require('mailgun-js')

const mailgun = Mailgun({
  apiKey: process.env.MAILGUN_API_KEY,
  domain: process.env.MAILGUN_DOMAIN,
})

const knex = Knex(require('./knexfile')[process.env.NODE_ENV])

Promise.resolve(main())
  .finally(() => {
    console.log('Finished')
    return knex.destroy()
  })

async function main () {
  return Promise.all(knex('emails').where('is_enabled', true).map(e => {
    return send(e)
  }))
}

async function send (args) {
  const fromDate = moment()
	const toDate = moment().day(args.day) // next Wednesday (3 + 7)
  const serviceTypes = args.service_types
  const teams = args.teams

  let services = []

  for (const t of serviceTypes) {
    let { data: stTeams } = await queryPco(`service_types/${t}/teams`, { cache: true })

    stTeams = stTeams.filter(t => {
      return teams.includes(t.attributes.name)
    }).map(t => {
      return t.id
    })

    const { data: serviceType } = await queryPco(`service_types/${t}`, { cache: true })
    const { data: plans } = await queryPco(`service_types/${t}/plans?filter=future&order=sort_date`, { cache: true })

    for (const p of plans) {
      const sortDate = moment(p.attributes.sort_date)

      if (sortDate.isSameOrAfter(fromDate, 'day') && sortDate.isSameOrBefore(toDate, 'day')) {
        const { data: service } = await queryPco(p.links.self, { cache: true })

        service.relationships.needed_positions = await queryPco(
          service.links.needed_positions, { cache: true }
        )

        const teamMembers = await queryPco(
          service.links.team_members, { cache: true }
        )

        service.relationships.needed_positions = service.relationships.needed_positions.data.filter(np => {
          return stTeams.includes(np.relationships.team.data.id)
        })

        service.relationships.service_type = serviceType
        service.relationships.team_members = []

        for (const tm of teamMembers.data) {
          if (stTeams.includes(tm.relationships.team.data.id)) {
            service.relationships.team_members.push(tm)
          }
        }

        services.push(service)
      }
    }
  }

  services = sortBy(services, d => d.attributes.sort_date)


  const nunjucksEnv = new nunjucks.Environment(
    new nunjucks.FileSystemLoader('views')
  )

  nunjucksEnv.addFilter('date', nunjucksDateFilter)
  nunjucksEnv.addFilter('pp', (v) => JSON.stringify(v, null, 2))

  const html = nunjucksEnv.render('email.njk', {
    services,
    today: new Date()
  })

  if (process.env.EXPORT_FILE) {
    return fs.writeFileSync(process.env.EXPORT_FILE, html)
  } else {
    if (!args.last_html || html !== args.last_html) {
      await mailgun.messages().send({
        from: 'PCO <pco@znarkus.com>',
        to: args.email,
        subject: 'Rosters until ' + toDate.format('ddd D MMM YYYY'),
        html
      })

      await knex('emails').where('id', args.id).update('last_html', html)
    } else {
      console.error('Skipping email because nothing has changed')
    }
  }
}

function queryPco (path, opts = {}) {
  const url = path.indexOf('://') === -1
    ? 'https://api.planningcenteronline.com/services/v2/' + path
    : path

  const cachePath = url.replace(/[^a-z0-9]/gi, '_') + '.json'

  if (opts.cache) {
    try {
      return require('./' + cachePath)
    } catch (err) {
      // Ignore
    }
  }

  return Promise.resolve(request({
    uri: url,
    auth: {
      user: process.env.PAT_APP_ID,
      pass: process.env.PAT_SECRET,
    },
    json: true,
  })).tap(res => {
    if (opts.cache) {
      fs.writeFileSync(cachePath, JSON.stringify(res))
    }
  })
}

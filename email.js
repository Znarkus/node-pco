'use strict'

const fs = require('fs')
const request = require('request-promise')
const moment = require('moment')
const { sortBy } = require('lodash')
const nunjucks = require('nunjucks')
const nunjucksDateFilter = require('nunjucks-date-filter')
const Knex = require('knex')
const Mailgun = require('mailgun-js')
const debug = require('debug')('pco:email')

const mailgun = Mailgun({
  apiKey: process.env.MAILGUN_API_KEY,
  domain: process.env.MAILGUN_DOMAIN,
})

const knex = Knex(require('./knexfile')[process.env.NODE_ENV])

Promise.resolve(main())
  .then(() => {
    console.log('Finished')
    return knex.destroy()
  })
  .catch(err => {
    console.error(err)
    return knex.destroy()
  })

 function main () {
  return knex('emails')
    .where('is_enabled', true)
    .map(e => {
      return send(e)
    })
}

async function send (args) {
  const fromDate = moment()
	const toDate = moment().day(args.day) // next Wednesday (3 + 7)
  const serviceTypes = args.service_types
  const teams = args.teams

  let services = []

  for (const t of serviceTypes) {
    debug(`Service type: ${t}`)
    let { data: stTeams } = await queryPco(`service_types/${t}/teams`)

    stTeams = stTeams.filter(t => {
      const include = teams.includes(t.attributes.name)
      debug(`Team: ${t.attributes.name} ${include ? '- Include' : ''}`)
      return include
    }).map(t => {
      return t.id
    })

    const { data: serviceType } = await queryPco(`service_types/${t}`)
    const { data: plans } = await queryPco(`service_types/${t}/plans?filter=future&order=sort_date`)

    for (const p of plans) {
      const sortDate = moment(p.attributes.sort_date)

      if (sortDate.isSameOrAfter(fromDate, 'day') && sortDate.isSameOrBefore(toDate, 'day')) {
        const { data: service } = await queryPco(p.links.self)

        service.rosters = []
        service.relationships.service_type = serviceType
        service.relationships.team_members = []

        debug(`Service: ${service.attributes.sort_date} ${service.relationships.service_type.attributes.name}`)

        service.relationships.needed_positions = await queryPco(
          service.links.needed_positions
        )

        const teamMembers = await queryPco(
          service.links.team_members + '?per_page=100'
        )

        service.relationships.needed_positions = service.relationships.needed_positions.data.filter(np => {
          const include = stTeams.includes(np.relationships.team.data.id)
          debug(`Needed: ${np.attributes.team_position_name} ${include ? '- Include' : ''}`)
          return include
            // service.rosters.push({
            //   position_name: np.attributes.team_position_name,
            //   missing_quantity: np.attributes.quantity,
            //   status: 'M',
            // })

            // return true
        })

        for (const tm of teamMembers.data) {
          debug(`Team: ${tm.attributes.team_position_name}`)

          if (stTeams.includes(tm.relationships.team.data.id)) {
            service.relationships.team_members.push(tm)

            debug(`- ${tm.attributes.status} ${tm.attributes.name}`)

            service.rosters.push({
              position_name: tm.attributes.team_position_name,
              name: tm.attributes.name,
              status: tm.attributes.status,
            })
          }
        }

        service.rosters = sortBy(service.rosters, 'position_name')

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

async function queryPco (path, opts = {}) {
  opts.cache = process.env.NODE_ENV === 'development'

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

  try {
    const res = await request({
      uri: url,
      auth: {
        user: process.env.PAT_APP_ID,
        pass: process.env.PAT_SECRET,
      },
      json: true,
    })

    if (opts.cache) {
      fs.writeFileSync(cachePath, JSON.stringify(res))
    }

    return res

  } catch (err) {
    console.error(`${err.error.errors[0].status} http error for ${url}`)

    throw err
  }
}

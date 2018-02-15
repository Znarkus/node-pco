'use strict'

global.Promise = require('bluebird')

const fs = require('fs')
const request = require('request-promise')
const moment = require('moment')
const { sortBy } = require('lodash')

Promise.resolve(main())
  .finally(() => {
    console.log('Klar')
  })

async function main () {
  const fromDate = moment()
	const toDate = moment().day(10) // next Wednesday (3 + 7)

  const serviceTypes = [
    564548,
    631183,
    692068,
    631184,
    564546,
  ]

  const teams = [
    'TV/Media'
  ]

  let services = []

  for (const t of serviceTypes) {
    let { data: stTeams } = await queryPco(`service_types/${t}/teams`, { cache: true })

    stTeams = stTeams.filter(t => {
      return teams.includes(t.attributes.name)
    }).map(t => {
      return t.id
    })

    const { data: plans } = await queryPco(`service_types/${t}/plans?filter=future&order=sort_date`, { cache: true })

    for (const p of plans) {
      const sortDate = moment(p.attributes.sort_date)

      if (sortDate.isSameOrAfter(fromDate, 'day') && sortDate.isSameOrBefore(toDate, 'day')) {
        const { data: service } = await queryPco(p.links.self, { cache: true })

        service.relationships.needed_positions = await queryPco(
          service.links.needed_positions, { cache: true })

        const teamMembers = await queryPco(
          service.links.team_members, { cache: true })

        service.relationships.needed_positions = service.relationships.needed_positions.data
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


  console.log(JSON.stringify(services, null, 2))

  // console.log(services.map(d => {
  //   return {
  //     sort_date: d.attributes.sort_date,
  //     title: d.attributes.title,
  //   }
  // }))
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

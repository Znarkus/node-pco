# node-pco
Planning Center Online reporting tool.

## Install
1. git clone
2. npm i

## Configuration
Copy config.example.json to config.json

## /sunday

Query parameters:
- {Date} date                   E.g. `date=2016-07-31`
- {int[]} serviceType           E.g. `serviceType=564544&serviceType=564546`
- {string[]} categoryName       E.g. `categoryName=TV%2FMedia`
- {string[]} excludePosition    E.g. `excludePosition=camera`
- {string[]} categoryPosition
  List of additional categories/position combinations to include.
  E.g. `categoryPosition=Worship%20Vocals|Lyrics`
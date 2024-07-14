#!/bin/bash

gen() {
  echo '<!DOCTYPE html><html><body><table>'

  gh issue list -R josh-berry/tab-stash -L 1000 \
    --json url,title,reactionGroups,createdAt \
    |jq -r '
      map(
        .reactionGroups |= map(select(.content=="THUMBS_UP"))[0]
        |{
          url: .url,
          title: .title,
          age: ((now - (.createdAt|fromdate)) / (24*60*60)),
          votes: ((.reactionGroups?.users?.totalCount // 0) + 1)
        }
        |select(.votes >= 3)
        |(.voteVelocity = .votes / .age)
      )
      |sort_by(-.voteVelocity)
      |.[]
      |"<tr><td>\(.votes)v/\(.age|floor)d</td><td><a href=\"\(.url)\">\(.title)</a></td></tr>"
    ' |head -n 10
  echo '</table></body></html>'
}

open -a firefox "data:text/html;base64,$(gen|base64)"

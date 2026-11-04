.[0] as $image
| .[1] as $project
| $image
| .components += $project.components
| .dependencies += $project.dependencies
| if (.components | map(."bom-ref") | unique | length) == (.components | length)
  then .
  else error("the image's SBOM and the project's share bom-refs")
  end

# The image's SBOM with the components and dependencies of a project's package
# SBOM added: jq -s -f merge.jq image.cdx.json project.cdx.json. Syft derives
# each bom-ref from where it found the package, so the two share none.
.[0] as $image
| .[1] as $project
| $image
| .components += $project.components
| .dependencies += $project.dependencies
| if (.components | map(."bom-ref") | unique | length) == (.components | length)
  then .
  else error("the image's SBOM and the project's share bom-refs")
  end

# Road-matching service for Field Duty routes (OSRM + OpenStreetMap). Deployed as its OWN Railway service
# (root directory: osrm). Nothing leaves your infrastructure: the app talks to it over Railway's private network.
#
# Region: build argument PBF_URL (default = northern India: Delhi NCR, UP, Haryana, Punjab, Rajasthan...).
# Other Geofabrik zones: western-zone, southern-zone, eastern-zone, central-zone, north-eastern-zone.
# Preparing the road graph needs a few GB of RAM at build time; if a build runs out of memory use a smaller zone.
FROM alpine:3.20 AS download
ARG PBF_URL=https://download.geofabrik.de/asia/india/northern-zone-latest.osm.pbf
RUN apk add --no-cache wget ca-certificates && wget -q -O /region.osm.pbf "$PBF_URL"

FROM ghcr.io/project-osrm/osrm-backend:v5.27.1 AS prepare
COPY --from=download /region.osm.pbf /data/region.osm.pbf
RUN osrm-extract -p /opt/car.lua /data/region.osm.pbf \
 && osrm-partition /data/region.osrm \
 && osrm-customize /data/region.osrm \
 && rm /data/region.osm.pbf

FROM ghcr.io/project-osrm/osrm-backend:v5.27.1
COPY --from=prepare /data /data
EXPOSE 5000
CMD ["osrm-routed", "--algorithm", "mld", "--max-matching-size", "200", "--port", "5000", "/data/region.osrm"]

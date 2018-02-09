import _ from 'lodash';
import ConduitSpinner from "./ConduitSpinner.jsx";
import ErrorBanner from './ErrorBanner.jsx';
import { incompleteMeshMessage } from './util/CopyUtils.jsx';
import Metric from './Metric.jsx';
import PageHeader from './PageHeader.jsx';
import React from 'react';
import ResourceHealthOverview from './ResourceHealthOverview.jsx';
import ResourceMetricsOverview from './ResourceMetricsOverview.jsx';
import { rowGutter } from './util/Utils.js';
import TabbedMetricsTable from './TabbedMetricsTable.jsx';
import UpstreamDownstream from './UpstreamDownstream.jsx';
import { Col, Row } from 'antd';
import { getPodsByDeployment, processRollupMetrics, processTimeseriesMetrics } from './util/MetricUtils.js';
import './../../css/deployment.css';
import 'whatwg-fetch';

const Fragment = React.Fragment;

export default class DeploymentDetail extends React.Component {
  constructor(props) {
    super(props);
    this.api = this.props.api;
    this.handleApiError = this.handleApiError.bind(this);
    this.loadFromServer = this.loadFromServer.bind(this);
    this.state = this.initialState(this.props.location);
  }

  componentDidMount() {
    this.loadFromServer();
    this.timerId = window.setInterval(this.loadFromServer, this.state.pollingInterval);
  }

  componentWillReceiveProps(nextProps) {
    window.scrollTo(0, 0);
    this.setState(this.initialState(nextProps.location), () => {
      this.loadFromServer();
    });
  }

  componentWillUnmount() {
    window.clearInterval(this.timerId);
  }

  initialState(location) {
    let urlParams = new URLSearchParams(location.search);
    let deployment = urlParams.get("deploy");
    return {
      lastUpdated: 0,
      pollingInterval: 10000,
      deploy: deployment,
      metrics: [],
      pods: [],
      upstreamMetrics: [],
      downstreamMetrics: [],
      pathMetrics: [],
      pendingRequests: false,
      loaded: false,
      error: ''
    };
  }

  loadFromServer() {
    if (this.state.pendingRequests) {
      return; // don't make more requests if the ones we sent haven't completed
    }
    this.setState({ pendingRequests: true });

    let urls = this.api.urlsForResource;

    let podListFetch = this.api.fetchPods();
    let deployMetricsUrl = urls["deployment"].url(this.state.deploy).ts;
    let upstreamRollupUrl = urls["upstream_deployment"].url(this.state.deploy).rollup;
    let downstreamRollupUrl = urls["downstream_deployment"].url(this.state.deploy).rollup;
    let pathMetricsUrl = urls["path"].url(this.state.deploy).rollup;

    let deployFetch = this.api.fetchMetrics(deployMetricsUrl);
    let upstreamFetch = this.api.fetchMetrics(upstreamRollupUrl);
    let downstreamFetch = this.api.fetchMetrics(downstreamRollupUrl);
    let pathsFetch = this.api.fetchMetrics(pathMetricsUrl);

    // expose serverPromise for testing
    this.serverPromise = Promise.all([
      deployFetch, upstreamFetch, downstreamFetch, podListFetch, pathsFetch
    ])
      .then(([deployMetrics, upstreamRollup, downstreamRollup, podList, paths]) => {
        let tsByDeploy = processTimeseriesMetrics(deployMetrics.metrics, "targetDeploy");
        let upstreamMetrics = processRollupMetrics(upstreamRollup.metrics, "sourceDeploy");
        let downstreamMetrics = processRollupMetrics(downstreamRollup.metrics, "targetDeploy");
        let pathMetrics = processRollupMetrics(paths.metrics, "path");

        let deploy = _.find(getPodsByDeployment(podList.pods), ["name", this.state.deploy]);

        this.setState({
          added: deploy.added,
          pods: deploy.pods,
          deployTs: _.get(tsByDeploy, this.state.deploy, {}),
          upstreamMetrics: upstreamMetrics,
          downstreamMetrics: downstreamMetrics,
          pathMetrics: pathMetrics,
          lastUpdated: Date.now(),
          pendingRequests: false,
          loaded: true,
          error: ''
        });
      }).catch(this.handleApiError);
  }

  handleApiError(e) {
    this.setState({
      pendingRequests: false,
      error: `Error getting data from server: ${e.message}`
    });
  }

  numUpstreams() {
    return _.size(this.state.upstreamMetrics);
  }

  numDownstreams() {
    return _.size(this.state.downstreamMetrics);
  }

  renderSections() {
    let srTs = _.get(this.state.deployTs, "SUCCESS_RATE", []);
    let currentSuccessRate = _.get(_.last(srTs), "value");

    return [
      <ResourceHealthOverview
        key="deploy-health-pane"
        resourceName={this.state.deploy}
        resourceType="deployment"
        currentSr={currentSuccessRate}
        upstreamMetrics={this.state.upstreamMetrics}
        downstreamMetrics={this.state.downstreamMetrics}
        deploymentAdded={this.state.added} />,
      _.isEmpty(this.state.deployTs) ? null :
        <ResourceMetricsOverview
          key="stat-pane"
          resourceType="deployment"
          lastUpdated={this.state.lastUpdated}
          timeseries={this.state.deployTs}
          window={this.api.getMetricsWindow()} />,
      this.renderMidsection(),
      <UpstreamDownstream
        key="deploy-upstream-downstream"
        resourceType="deployment"
        resourceName={this.state.deploy}
        lastUpdated={this.state.lastUpdated}
        upstreamMetrics={this.state.upstreamMetrics}
        downstreamMetrics={this.state.downstreamMetrics}
        api={this.api} />,
      this.renderPaths()
    ];
  }

  renderMidsection() {

    return (
      <Fragment key="deployment-pod-summary">
        <Row gutter={rowGutter}>

          <Col span={8}>
            <div className="border-container border-neutral deployment-details">
              <div className="border-container-content">
                <div className=" subsection-header">Deployment details</div>
                <Metric title="Upstream deployments" value={this.numUpstreams()} />
                <Metric title="Downstream deployments" value={this.numDownstreams()} />
              </div>
            </div>
          </Col>
        </Row>

      </Fragment>
    );
  }

  renderPaths() {
    return _.size(this.state.pathMetrics) === 0 ? null :
      <div key="deployment-paths">
        <div className="border-container border-neutral subsection-header">
          <div className="border-container-content subsection-header">
              Paths
          </div>
        </div>
        <TabbedMetricsTable
          resource="path"
          metrics={this.state.pathMetrics}
          api={this.api} />
      </div>;
  }

  renderDeploymentTitle() {
    return (
      <div className="deployment-title">
        <h1>{this.state.deploy}</h1>
        {
          !this.state.added ? (
            <p className="status-badge unadded">UNADDED</p>
          ) : null
        }
      </div>
    );
  }

  render() {
    return (
      <div className="page-content deployment-detail">
        { !this.state.error ? null : <ErrorBanner message={this.state.error} /> }
        { !this.state.loaded ? <ConduitSpinner /> :
          <div>
            <PageHeader
              subHeaderTitle="Deployment detail"
              subHeader={this.renderDeploymentTitle()}
              subMessage={!this.state.added ? incompleteMeshMessage(this.state.deploy) : null}
              api={this.api} />

            {this.renderSections()}
          </div>
        }
      </div>
    );
  }
}
